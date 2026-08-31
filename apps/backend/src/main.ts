import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { createCsrfOriginCheck } from "./common/csrf-origin-check";

function allowedOrigins(): string[] {
  const origins = (process.env.CORS_ORIGIN ?? "http://localhost:3100")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // A bare hostname (no scheme) never matches the browser's Origin header,
  // which is always scheme://host[:port] — this silently breaks CORS/CSRF
  // in production (seen in practice: CORS_ORIGIN set to "example.com"
  // instead of "https://example.com" behind a reverse proxy/tunnel), so
  // warn loudly at boot instead of failing invisibly on the first request.
  for (const origin of origins) {
    if (!/^https?:\/\//.test(origin)) {
      console.warn(
        `[CORS] CORS_ORIGIN entry "${origin}" has no http:// or https:// scheme and will never match a ` +
          `browser's Origin header — requests from your real domain will be blocked. Set it to the full ` +
          `public URL, e.g. "https://${origin}".`,
      );
    }
  }

  return origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // CSP only restricts which script/style/resource origins responses may
  // reference — unlike HSTS it has nothing to do with HTTP vs HTTPS
  // transport, so there's no reason to disable it for a plain-HTTP LAN
  // reverse proxy. On by default (Helmet's own sane defaults); DISABLE_CSP
  // is an escape hatch for an install that needs to load something Helmet's
  // default policy would block (flagged by CodeQL as an insecure Helmet
  // config while this was off by default — see SECURITY_AUDIT_REPORT.md #6).
  //
  // HSTS is different: it forces browsers to upgrade this origin to HTTPS
  // going forward, which genuinely breaks a plain-HTTP LAN reverse proxy
  // (see the COOKIE_SECURE comment in auth.controller.ts) — so that one
  // stays opt-in, tied to the same flag that marks an HTTPS deployment.
  app.use(
    helmet({
      contentSecurityPolicy: process.env.DISABLE_CSP === "true" ? false : undefined,
      hsts: process.env.COOKIE_SECURE === "true",
    }),
  );
  app.use(cookieParser());
  app.use(createCsrfOriginCheck(allowedOrigins()));
  app.enableCors({
    origin: allowedOrigins(),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 4100);
  // Defaults to every interface (0.0.0.0), required for Docker/CasaOS where
  // the container's exposed port must be reachable from the host's bridge
  // network. The Windows MSIX desktop build is the one deployment target
  // that must NOT be LAN-reachable (see packaging/windows/README.md) — it
  // sets HOST=127.0.0.1 explicitly on the child process it spawns.
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen(port, host);
}

bootstrap().catch((error: unknown) => {
  console.error("Fatal error during application bootstrap", error);
  process.exit(1);
});
