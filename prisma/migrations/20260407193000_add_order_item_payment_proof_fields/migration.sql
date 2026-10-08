ALTER TABLE "order_items"
ADD COLUMN "paymentProofUrl" TEXT,
ADD COLUMN "paymentProofNote" TEXT,
ADD COLUMN "paymentProofAt" TIMESTAMP(3);
