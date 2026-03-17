#!/bin/bash
set -euo pipefail
npm ci
docker run -d --name gw-pm-test-db \
  -e POSTGRES_DB=gwpm_test -e POSTGRES_USER=gwpm -e POSTGRES_PASSWORD=gwpm_test \
  -p 5433:5432 postgres:16-alpine
docker run -d --name gw-pm-test-redis -p 6380:6379 redis:7-alpine
sleep 3
DATABASE_URL=postgresql://gwpm:gwpm_test@localhost:5433/gwpm_test npm run db:migrate
export DATABASE_URL=postgresql://gwpm:gwpm_test@localhost:5433/gwpm_test
export REDIS_URL=redis://localhost:6380
export NODE_ENV=test
npx tsx scripts/seed/index.ts
