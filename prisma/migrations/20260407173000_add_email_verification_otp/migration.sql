ALTER TABLE "users"
ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "email_verification_otps" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "otpHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_verification_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_verification_otps_userId_idx" ON "email_verification_otps"("userId");
CREATE INDEX "email_verification_otps_expiresAt_idx" ON "email_verification_otps"("expiresAt");

ALTER TABLE "email_verification_otps"
ADD CONSTRAINT "email_verification_otps_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
