import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { createCsrfOriginCheck } from "./common/csrf-origin-check";

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? "http://localhost:3100")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // Self-hosted deployments commonly sit behind a plain-HTTP LAN reverse proxy
  // (see the COOKIE_SECURE comment in auth.controller.ts), so CSP/HSTS are
  // opt-in via env rather than forced on, to avoid breaking those setups.
  app.use(
    helmet({
      contentSecurityPolicy: process.env.ENABLE_CSP === "true" ? undefined : false,
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
  await app.listen(port, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  console.error("Fatal error during application bootstrap", error);
  process.exit(1);
});
