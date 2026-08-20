import { BadRequestException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

@Injectable()
export class UpdateService {
  // Triggers a real self-update-and-restart. Deliberately does NOT run
  // `git pull && docker compose up` itself: this container is one of the
  // services `docker compose up` would recreate, so the process issuing
  // that command would be killed mid-sequence by its own command, leaving
  // the stack half-updated. Instead it uses its own mounted docker.sock to
  // launch a separate, ephemeral one-shot helper container that isn't
  // itself being recreated, so it survives this container's teardown and
  // finishes the update — same design as Submify/nodedr-restaurant-pos's
  // own self-update. Responds before the update finishes — the caller is
  // expected to poll GET /api/health until it responds again.
  async applyUpdate(): Promise<{ status: string; message: string }> {
    const repoDir = (process.env.REPO_DIR ?? "").trim();
    if (!repoDir) {
      throw new BadRequestException("REPO_DIR is not configured — self-update is unavailable");
    }

    const updateScript = `set -e; cd ${shellQuote(repoDir)}; git pull --ff-only; docker compose up --build -d`;
    const args = [
      "run",
      "--rm",
      "-d",
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-v",
      `${repoDir}:${repoDir}`,
      "-w",
      repoDir,
      "docker:cli",
      "sh",
      "-c",
      updateScript,
    ];

    try {
      await execFileAsync("docker", args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`could not start the update helper container: ${message}`);
    }

    return {
      status: "update started",
      message:
        "The application is updating and will restart shortly. This page will stop responding until it comes back up.",
    };
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
