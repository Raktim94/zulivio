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
import { FieldEncryptionService } from "../common/crypto/field-encryption.service";
import { SetBackupConfigDto } from "./dto/set-backup-config.dto";

const execFileAsync = promisify(execFile);
const UPLOAD_ROOT = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
const CONFIG_ID = "singleton";

interface EffectiveConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  intervalDays: number;
  retainCount: number;
  source: "database" | "environment";
}

function mask(value: string): string {
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}

/**
 * Full-instance backup (Postgres + the uploads volume) to any S3-compatible
 * bucket. Instance-wide by design — a pg_dump of the shared database has no
 * single organizationId to scope to.
 *
 * Configurable two ways, checked in this order: a row in `backup_config`
 * (set from Settings, so the app is self-contained — no CasaOS/env-var
 * editing required once connected), falling back to S3_BACKUP_* env vars
 * (still supported for CasaOS users who prefer configuring it from the
 * install/config screen, or headless deployments).
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  private async getConfig(): Promise<EffectiveConfig | null> {
    const row = await this.prisma.backupConfig.findUnique({ where: { id: CONFIG_ID } });
    if (row) {
      return {
        endpoint: row.endpoint,
        bucket: row.bucket,
        accessKeyId: row.accessKeyId,
        // Rows written before FieldEncryptionService existed are legacy
        // plaintext; decrypt() passes those through unchanged and they get
        // re-encrypted the next time setConfig() runs.
        secretAccessKey: this.fieldEncryption.decrypt(row.secretAccessKey),
        region: row.region,
        intervalDays: row.intervalDays,
        retainCount: row.retainCount,
        source: "database",
      };
    }

    const { S3_BACKUP_ENDPOINT, S3_BACKUP_BUCKET, S3_BACKUP_ACCESS_KEY_ID, S3_BACKUP_SECRET_ACCESS_KEY } = process.env;
    if (S3_BACKUP_ENDPOINT && S3_BACKUP_BUCKET && S3_BACKUP_ACCESS_KEY_ID && S3_BACKUP_SECRET_ACCESS_KEY) {
      return {
        endpoint: S3_BACKUP_ENDPOINT,
        bucket: S3_BACKUP_BUCKET,
        accessKeyId: S3_BACKUP_ACCESS_KEY_ID,
        secretAccessKey: S3_BACKUP_SECRET_ACCESS_KEY,
        region: process.env.S3_BACKUP_REGION ?? "auto",
        intervalDays: Number(process.env.S3_BACKUP_INTERVAL_DAYS ?? 3),
        retainCount: Number(process.env.S3_BACKUP_RETAIN_COUNT ?? 2),
        source: "environment",
      };
    }

    return null;
  }

  private s3Client(config: EffectiveConfig): S3Client {
    return new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  private requireMasterOwner(actor: AuthenticatedEmployee, action: string) {
    if (actor.role !== Role.MASTER_OWNER) {
      throw new ForbiddenException(`Only the Master Owner can ${action}`);
    }
  }

  async status() {
    const [config, lastVerified, lastAny] = await Promise.all([
      this.getConfig(),
      this.prisma.backupRecord.findFirst({ where: { status: "VERIFIED" }, orderBy: { completedAt: "desc" } }),
      this.prisma.backupRecord.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);

    const nextScheduledAt =
      config && lastVerified?.completedAt
        ? new Date(lastVerified.completedAt.getTime() + config.intervalDays * 24 * 60 * 60 * 1000)
        : null;

    return {
      configured: config !== null,
      source: config?.source ?? null,
      endpoint: config?.endpoint ?? null,
      bucket: config?.bucket ?? null,
      region: config?.region ?? null,
      accessKeyIdMasked: config ? mask(config.accessKeyId) : null,
      intervalDays: config?.intervalDays ?? 3,
      retainCount: config?.retainCount ?? 2,
      lastBackup: lastAny,
      nextScheduledAt,
    };
  }

  async list() {
    return this.prisma.backupRecord.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
  }

  /**
   * Saves S3 credentials from Settings, but only after a live connectivity
   * check (put + get + delete a small probe object) — surfacing a bad
   * endpoint/bucket/key immediately is much better than finding out three
   * days later when the scheduled backup silently fails.
   */
  async setConfig(actor: AuthenticatedEmployee, dto: SetBackupConfigDto) {
    this.requireMasterOwner(actor, "configure backups");

    const candidate: EffectiveConfig = {
      endpoint: dto.endpoint,
      bucket: dto.bucket,
      accessKeyId: dto.accessKeyId,
      secretAccessKey: dto.secretAccessKey,
      region: dto.region ?? "auto",
      intervalDays: dto.intervalDays ?? 3,
      retainCount: dto.retainCount ?? 2,
      source: "database",
    };

    const s3 = this.s3Client(candidate);
    const probeKey = `connectivity-check/${Date.now()}.txt`;
    try {
      await s3.send(new PutObjectCommand({ Bucket: candidate.bucket, Key: probeKey, Body: Buffer.from("ok") }));
      await this.downloadBuffer(s3, candidate.bucket, probeKey);
      await s3.send(new DeleteObjectCommand({ Bucket: candidate.bucket, Key: probeKey }));
    } catch (err) {
      throw new BadRequestException(`Could not connect to that bucket: ${(err as Error).message}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { source: _source, ...persisted } = candidate;
    persisted.secretAccessKey = this.fieldEncryption.encrypt(persisted.secretAccessKey);
    await this.prisma.backupConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, ...persisted, updatedById: actor.id },
      update: { ...persisted, updatedById: actor.id },
    });

    return this.status();
  }

  async clearConfig(actor: AuthenticatedEmployee) {
    this.requireMasterOwner(actor, "remove the backup configuration");
    await this.prisma.backupConfig.deleteMany({ where: { id: CONFIG_ID } });
    return this.status();
  }

  async triggerManual(actor: AuthenticatedEmployee) {
    this.requireMasterOwner(actor, "trigger a manual backup");
    const config = await this.getConfig();
    if (!config) {
      throw new BadRequestException(
        "S3 backup is not configured. Add your S3 endpoint, bucket, and access key in Settings.",
      );
    }
    return this.runBackup(config, actor.id);
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
    const config = await this.getConfig();
    if (!config) return;

    const last = await this.prisma.backupRecord.findFirst({
      where: { status: "VERIFIED" },
      orderBy: { completedAt: "desc" },
    });
    const due =
      !last?.completedAt || Date.now() - last.completedAt.getTime() >= config.intervalDays * 24 * 60 * 60 * 1000;
    if (!due) return;

    this.logger.log(`Backup interval elapsed (${config.intervalDays}d) — starting scheduled backup`);
    try {
      await this.runBackup(config, "schedule");
    } catch (err) {
      this.logger.error(`Scheduled backup failed: ${(err as Error).message}`);
    }
  }

  private async runBackup(config: EffectiveConfig, triggeredBy: string) {
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

      const s3 = this.s3Client(config);
      const dbKey = `${timestamp}/db.dump`;
      const dbBuffer = await fs.readFile(dbDumpPath);
      const sha256 = createHash("sha256").update(dbBuffer).digest("hex");
      await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: dbKey, Body: dbBuffer }));

      let uploadsKey: string | undefined;
      let totalSize = dbBuffer.length;
      if (uploadsExist) {
        uploadsKey = `${timestamp}/uploads.tar.gz`;
        const uploadsBuffer = await fs.readFile(uploadsArchivePath);
        await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: uploadsKey, Body: uploadsBuffer }));
        totalSize += uploadsBuffer.length;
      }

      // Verify by downloading each object back and comparing its actual
      // bytes against the local file (sha256 for the db dump, length for
      // the uploads archive) — a real integrity check, and deliberately
      // not HeadObjectCommand: some S3-compatible servers (RustFS, tested
      // against here) return spurious 403s on HEAD for objects that GET
      // fetches correctly, so HEAD-based verification is not reliable
      // across implementations.
      const downloadedDb = await this.downloadBuffer(s3, config.bucket, dbKey);
      if (createHash("sha256").update(downloadedDb).digest("hex") !== sha256) {
        throw new Error("Verification failed: downloaded db backup does not match the uploaded content");
      }
      if (uploadsKey) {
        const uploadsBuffer = await fs.readFile(uploadsArchivePath);
        const downloadedUploads = await this.downloadBuffer(s3, config.bucket, uploadsKey);
        if (downloadedUploads.length !== uploadsBuffer.length) {
          throw new Error("Verification failed: downloaded uploads archive size does not match the local file");
        }
      }

      const completed = await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: "VERIFIED", dbKey, uploadsKey, sizeBytes: totalSize, sha256, completedAt: new Date() },
      });

      await this.enforceRetention(config);
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
  private async enforceRetention(config: EffectiveConfig) {
    const verified = await this.prisma.backupRecord.findMany({
      where: { status: "VERIFIED" },
      orderBy: { completedAt: "desc" },
    });
    const stale = verified.slice(config.retainCount);
    if (stale.length === 0) return;

    const s3 = this.s3Client(config);
    for (const old of stale) {
      try {
        if (old.dbKey) await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: old.dbKey }));
        if (old.uploadsKey) await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: old.uploadsKey }));
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

    const config = await this.getConfig();
    if (!config) {
      throw new BadRequestException("S3 backup is not configured.");
    }

    const record = await this.prisma.backupRecord.findFirst({ where: { id: backupId, status: "VERIFIED" } });
    if (!record?.dbKey) {
      throw new BadRequestException("Backup not found or not in a restorable (VERIFIED) state");
    }

    const s3 = this.s3Client(config);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zulivio-restore-"));
    const dbDumpPath = path.join(workDir, "db.dump");
    const uploadsArchivePath = path.join(workDir, "uploads.tar.gz");

    try {
      await this.downloadTo(s3, config.bucket, record.dbKey, dbDumpPath);
      await execFileAsync("pg_restore", [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--dbname",
        process.env.DATABASE_URL!,
        dbDumpPath,
      ]);

      if (record.uploadsKey) {
        await this.downloadTo(s3, config.bucket, record.uploadsKey, uploadsArchivePath);
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

  private async downloadBuffer(s3: S3Client, bucket: string, key: string): Promise<Buffer> {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  private async downloadTo(s3: S3Client, bucket: string, key: string, destPath: string) {
    await fs.writeFile(destPath, await this.downloadBuffer(s3, bucket, key));
  }
}
