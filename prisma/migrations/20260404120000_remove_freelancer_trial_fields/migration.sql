-- Remove freelancer trial / subscription-end tracking (feature removed)
ALTER TABLE "freelancers" DROP COLUMN IF EXISTS "subscriptionEndsAt";
ALTER TABLE "freelancers" DROP COLUMN IF EXISTS "isTrial";
