import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { google, sheets_v4 } from "googleapis";

/**
 * Real Google Sheets adapter, wired via a service-account JWT when
 * GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY are configured.
 * Without credentials this reports itself as disabled rather than faking
 * a working integration — the target spreadsheet must also be shared with
 * the service account email for either direction to succeed.
 */
@Injectable()
export class GoogleSheetsService {
  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_SHEETS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_PRIVATE_KEY);
  }

  private client(): sheets_v4.Sheets {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "Google Sheets integration is not configured. Set GOOGLE_SHEETS_CLIENT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY.",
      );
    }

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      key: (process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    return google.sheets({ version: "v4", auth });
  }

  async readRange(spreadsheetId: string, range: string): Promise<string[][]> {
    const sheets = this.client();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return (res.data.values ?? []) as string[][];
  }

  async writeRange(spreadsheetId: string, range: string, values: unknown[][]): Promise<void> {
    const sheets = this.client();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }
}
