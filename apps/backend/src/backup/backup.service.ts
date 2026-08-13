import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BadRequestException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";

const execFileAsync = promisify(execFile);
const UPLOAD_ROOT = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

/**
 * Full-instance backup (Postgres + the uploads volume) to any S3-compatible
 * bucket. Instance-wide by design — a pg_dump of the shared database has no
 * single organizationId to scope to. Configured entirely via env vars
 * (S3_BACKUP_*), matching this codebase's existing pattern for the Google
 * Sheets integration: no secrets stored in the DB, and exposed as editable
 * fields in the CasaOS/ZimaOS install UI via the x-casaos manifest.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly prisma: PrismaService) {}

  isConfigured(): boolean {
    return Boolean(
      process.env.S3_BACKUP_ENDPOINT &&
        process.env.S3_BACKUP_BUCKET &&
        process.env.S3_BACKUP_ACCESS_KEY_ID &&
        process.env.S3_BACKUP_SECRET_ACCESS_KEY,
    );
  }

  private get intervalDays(): number {
    return Number(process.env.S3_BACKUP_INTERVAL_DAYS ?? 3);
  }

  private get retainCount(): number {
    return Number(process.env.S3_BACKUP_RETAIN_COUNT ?? 2);
  }

  private get bucket(): string {
    return process.env.S3_BACKUP_BUCKET!;
  }

  private s3Client(): S3Client {
    return new S3Client({
      endpoint: process.env.S3_BACKUP_ENDPOINT,
      region: process.env.S3_BACKUP_REGION ?? "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_BACKUP_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_BACKUP_SECRET_ACCESS_KEY!,
      },
    });
  }

  async status() {
    const [lastVerified, lastAny] = await Promise.all([
      this.prisma.backupRecord.findFirst({ where: { status: "VERIFIED" }, orderBy: { completedAt: "desc" } }),
      this.prisma.backupRecord.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);

    const nextScheduledAt =
      this.isConfigured() && lastVerified?.completedAt
        ? new Date(lastVerified.completedAt.getTime() + this.intervalDays * 24 * 60 * 60 * 1000)
        : null;

    return {
      configured: this.isConfigured(),
      intervalDays: this.intervalDays,
      retainCount: this.retainCount,
      lastBackup: lastAny,
      nextScheduledAt,
    };
  }

  async list() {
    return this.prisma.backupRecord.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
  }

  private requireMasterOwner(actor: AuthenticatedEmployee, action: string) {
    if (actor.role !== Role.MASTER_OWNER) {
      throw new ForbiddenException(`Only the Master Owner can ${action}`);
    }
  }

  async triggerManual(actor: AuthenticatedEmployee) {
    this.requireMasterOwner(actor, "trigger a manual backup");
    if (!this.isConfigured()) {
      throw new BadRequestException(
        "S3 backup is not configured. Set S3_BACKUP_ENDPOINT, S3_BACKUP_BUCKET, S3_BACKUP_ACCESS_KEY_ID, and S3_BACKUP_SECRET_ACCESS_KEY.",
      );
    }
    return this.runBackup(actor.id);
  }

  /**
   * Checked hourly rather than scheduled directly on a 3-day cron, so the
   * interval survives container restarts (a plain 3-day timer would reset
   * on every restart and might never fire on a frequently-restarted CasaOS
   * box). The actual cadence is driven by comparing "now" against the last
   * VERIFIED backup's completedAt, not by this check's own frequency.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkSchedule() {
    if (!this.isConfigured()) return;

    const last = await this.prisma.backupRecord.findFirst({
      where: { status: "VERIFIED" },
      orderBy: { completedAt: "desc" },
    });
    const due = !last?.completedAt || Date.now() - last.completedAt.getTime() >= this.intervalDays * 24 * 60 * 60 * 1000;
    if (!due) return;

    this.logger.log(`Backup interval elapsed (${this.intervalDays}d) — starting scheduled backup`);
    try {
      await this.runBackup("schedule");
    } catch (err) {
      this.logger.error(`Scheduled backup failed: ${(err as Error).message}`);
    }
  }

  private async runBackup(triggeredBy: string) {
    const record = await this.prisma.backupRecord.create({ data: { triggeredBy, status: "PENDING" } });
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zulivio-backup-"));
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dbDumpPath = path.join(workDir, "db.dump");
    const uploadsArchivePath = path.join(workDir, "uploads.tar.gz");

    try {
      await this.prisma.backupRecord.update({ where: { id: record.id }, data: { status: "UPLOADING" } });

      // Custom format: compressed single file, restorable with
      // `pg_restore --clean --if-exists` for a clean overwrite on restore.
      await execFileAsync("pg_dump", ["--format=custom", "--file", dbDumpPath, process.env.DATABASE_URL!]);

      const uploadsExist = fsSync.existsSync(UPLOAD_ROOT);
      if (uploadsExist) {
        await execFileAsync("tar", [
          "-czf",
          uploadsArchivePath,
          "-C",
          path.dirname(UPLOAD_ROOT),
          path.basename(UPLOAD_ROOT),
        ]);
      }

      const s3 = this.s3Client();
      const dbKey = `${timestamp}/db.dump`;
      const dbBuffer = await fs.readFile(dbDumpPath);
      const sha256 = createHash("sha256").update(dbBuffer).digest("hex");
      await s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: dbKey, Body: dbBuffer }));

      let uploadsKey: string | undefined;
      let totalSize = dbBuffer.length;
      if (uploadsExist) {
        uploadsKey = `${timestamp}/uploads.tar.gz`;
        const uploadsBuffer = await fs.readFile(uploadsArchivePath);
        await s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: uploadsKey, Body: uploadsBuffer }));
        totalSize += uploadsBuffer.length;
      }

      // Verify by downloading each object back and comparing its actual
      // bytes against the local file (sha256 for the db dump, length for
      // the uploads archive) — a real integrity check, and deliberately
      // not HeadObjectCommand: some S3-compatible servers (RustFS, tested
      // against here) return spurious 403s on HEAD for objects that GET
      // fetches correctly, so HEAD-based verification is not reliable
      // across implementations.
      const downloadedDb = await this.downloadBuffer(s3, dbKey);
      if (createHash("sha256").update(downloadedDb).digest("hex") !== sha256) {
        throw new Error("Verification failed: downloaded db backup does not match the uploaded content");
      }
      if (uploadsKey) {
        const uploadsBuffer = await fs.readFile(uploadsArchivePath);
        const downloadedUploads = await this.downloadBuffer(s3, uploadsKey);
        if (downloadedUploads.length !== uploadsBuffer.length) {
          throw new Error("Verification failed: downloaded uploads archive size does not match the local file");
        }
      }

      const completed = await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: "VERIFIED", dbKey, uploadsKey, sizeBytes: totalSize, sha256, completedAt: new Date() },
      });

      await this.enforceRetention();
      return completed;
    } catch (err) {
      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: "FAILED", error: (err as Error).message, completedAt: new Date() },
      });
      throw err;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Keeps the most recent `retainCount` VERIFIED backups and deletes older
   * ones, always oldest-first, so a verified backup exists in S3 at every
   * point in time — never a window with zero backups.
   */
  private async enforceRetention() {
    const verified = await this.prisma.backupRecord.findMany({
      where: { status: "VERIFIED" },
      orderBy: { completedAt: "desc" },
    });
    const stale = verified.slice(this.retainCount);
    if (stale.length === 0) return;

    const s3 = this.s3Client();
    for (const old of stale) {
      try {
        if (old.dbKey) await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: old.dbKey }));
        if (old.uploadsKey) await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: old.uploadsKey }));
        await this.prisma.backupRecord.delete({ where: { id: old.id } });
      } catch (err) {
        this.logger.error(`Failed to delete stale backup ${old.id}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Destructive: drops and recreates the entire database from the backup,
   * then replaces the uploads volume. Gated to Master Owner plus an
   * explicit confirmation string so it can never fire from a stray click.
   */
  async restore(actor: AuthenticatedEmployee, backupId: string, confirm: string) {
    this.requireMasterOwner(actor, "restore a backup");
    if (confirm !== "RESTORE") {
      throw new BadRequestException('This is destructive. Pass confirm: "RESTORE" to proceed.');
    }

    const record = await this.prisma.backupRecord.findFirst({ where: { id: backupId, status: "VERIFIED" } });
    if (!record?.dbKey) {
      throw new BadRequestException("Backup not found or not in a restorable (VERIFIED) state");
    }

    const s3 = this.s3Client();
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zulivio-restore-"));
    const dbDumpPath = path.join(workDir, "db.dump");
    const uploadsArchivePath = path.join(workDir, "uploads.tar.gz");

    try {
      await this.downloadTo(s3, record.dbKey, dbDumpPath);
      await execFileAsync("pg_restore", [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--dbname",
        process.env.DATABASE_URL!,
        dbDumpPath,
      ]);

      if (record.uploadsKey) {
        await this.downloadTo(s3, record.uploadsKey, uploadsArchivePath);
        // Empty UPLOAD_ROOT's contents rather than removing the directory
        // itself: the container's non-root user owns everything inside it
        // but not necessarily its parent, so an rmdir/mkdir round-trip on
        // UPLOAD_ROOT itself can fail with EACCES. tar then recreates the
        // same tree from the archive, merging into the now-empty directory.
        const existingEntries = await fs.readdir(UPLOAD_ROOT).catch(() => []);
        await Promise.all(
          existingEntries.map((entry) => fs.rm(path.join(UPLOAD_ROOT, entry), { recursive: true, force: true })),
        );
        await execFileAsync("tar", ["-xzf", uploadsArchivePath, "-C", path.dirname(UPLOAD_ROOT)]);
      }

      return { ok: true, restoredFrom: record.id };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  private async downloadBuffer(s3: S3Client, key: string): Promise<Buffer> {
    const res = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  private async downloadTo(s3: S3Client, key: string, destPath: string) {
    await fs.writeFile(destPath, await this.downloadBuffer(s3, key));
  }
}
