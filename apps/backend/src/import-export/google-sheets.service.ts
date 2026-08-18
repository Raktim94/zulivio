import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { google, sheets_v4 } from "googleapis";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedEmployee } from "../common/guards/auth.guard";
import { FieldEncryptionService } from "../common/crypto/field-encryption.service";
import { SetGoogleSheetsConfigDto } from "./dto/set-google-sheets-config.dto";

const CONFIG_ID = "singleton";

interface EffectiveConfig {
  clientEmail: string;
  privateKey: string;
  source: "database" | "environment";
}

/**
 * Real Google Sheets adapter, wired via a service-account JWT.
 *
 * Configurable two ways, checked in this order: a row in
 * `google_sheets_config` (set from Settings, so the app is self-contained —
 * no env-var editing or redeploy required once connected), falling back to
 * GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY env vars (still
 * supported for CasaOS users who prefer configuring it from the
 * install/config screen, or headless deployments). Without either, this
 * reports itself as disabled rather than faking a working integration — the
 * target spreadsheet must also be shared with the service account email for
 * either read or write direction to succeed.
 */
@Injectable()
export class GoogleSheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  private async getConfig(): Promise<EffectiveConfig | null> {
    const row = await this.prisma.googleSheetsConfig.findUnique({ where: { id: CONFIG_ID } });
    if (row) {
      // Rows written before FieldEncryptionService existed are legacy
      // plaintext; decrypt() passes those through unchanged and they get
      // re-encrypted the next time setConfig() runs.
      return { clientEmail: row.clientEmail, privateKey: this.fieldEncryption.decrypt(row.privateKey), source: "database" };
    }

    const { GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY } = process.env;
    if (GOOGLE_SHEETS_CLIENT_EMAIL && GOOGLE_SHEETS_PRIVATE_KEY) {
      return { clientEmail: GOOGLE_SHEETS_CLIENT_EMAIL, privateKey: GOOGLE_SHEETS_PRIVATE_KEY, source: "environment" };
    }

    return null;
  }

  private jwtClient(config: EffectiveConfig): sheets_v4.Sheets {
    const auth = new google.auth.JWT({
      email: config.clientEmail,
      key: config.privateKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
  }

  async isConfigured(): Promise<boolean> {
    return (await this.getConfig()) !== null;
  }

  private async client(): Promise<sheets_v4.Sheets> {
    const config = await this.getConfig();
    if (!config) {
      throw new ServiceUnavailableException(
        "Google Sheets integration is not configured. Connect a service account in Settings.",
      );
    }
    return this.jwtClient(config);
  }

  async readRange(spreadsheetId: string, range: string): Promise<string[][]> {
    const sheets = await this.client();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return (res.data.values ?? []) as string[][];
  }

  async writeRange(spreadsheetId: string, range: string, values: unknown[][]): Promise<void> {
    const sheets = await this.client();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }

  private requireMasterOwner(actor: AuthenticatedEmployee, action: string) {
    if (actor.role !== Role.MASTER_OWNER) {
      throw new ForbiddenException(`Only the Master Owner can ${action}`);
    }
  }

  async status() {
    const config = await this.getConfig();
    return {
      configured: config !== null,
      source: config?.source ?? null,
      clientEmail: config?.clientEmail ?? null,
    };
  }

  /**
   * Saves service-account credentials from Settings, but only after a live
   * check (mint an access token via the JWT) — surfacing a malformed key or
   * revoked service account immediately is much better than finding out on
   * the next export/import attempt.
   */
  async setConfig(actor: AuthenticatedEmployee, dto: SetGoogleSheetsConfigDto) {
    this.requireMasterOwner(actor, "configure the Google Sheets integration");

    const candidate: EffectiveConfig = { clientEmail: dto.clientEmail, privateKey: dto.privateKey, source: "database" };
    try {
      const auth = new google.auth.JWT({
        email: candidate.clientEmail,
        key: candidate.privateKey.replace(/\\n/g, "\n"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      await auth.authorize();
    } catch (err) {
      throw new BadRequestException(`Could not authenticate with that service account: ${(err as Error).message}`);
    }

    const encryptedPrivateKey = this.fieldEncryption.encrypt(candidate.privateKey);
    await this.prisma.googleSheetsConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, clientEmail: candidate.clientEmail, privateKey: encryptedPrivateKey, updatedById: actor.id },
      update: { clientEmail: candidate.clientEmail, privateKey: encryptedPrivateKey, updatedById: actor.id },
    });

    return this.status();
  }

  async clearConfig(actor: AuthenticatedEmployee) {
    this.requireMasterOwner(actor, "remove the Google Sheets configuration");
    await this.prisma.googleSheetsConfig.deleteMany({ where: { id: CONFIG_ID } });
    return this.status();
  }
}
