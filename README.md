# AJK Shop Backend

Backend API for AJK Shop built with Hono, Prisma, PostgreSQL (Supabase), and TypeScript.

## Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL / Supabase account

### Installation
```bash
npm install
```

### Environment Setup
Create a `.env` file based on `.env.example` and set the required database connection strings and keys.

### Database Migration & Studio
```bash
npx prisma db push
npx prisma studio
```

### Running the App
```bash
# Development
npm run dev

# Production
npm run build
npm start
```
