import 'dotenv/config';

// Prisma 7 configuration file
// The CLI uses the URL provided here for migrations and db push.
// We use DIRECT_URL (port 5432) to bypass the transaction pooler.

export default {
  datasource: {
    url: process.env.DIRECT_URL,
  },
};
