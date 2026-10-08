ALTER TABLE "password_reset_otps"
ADD COLUMN "resendCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "email_verification_otps"
ADD COLUMN "resendCount" INTEGER NOT NULL DEFAULT 0;
