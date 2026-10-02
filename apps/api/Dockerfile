FROM node:22.23.3-alpine3.24 AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/api ./apps/api
RUN npm run db:generate --workspace @asdmr/api \
  && npm run build --workspace @asdmr/api

FROM build AS migrations
WORKDIR /app
CMD ["npm", "run", "db:deploy", "--workspace", "@asdmr/api"]

FROM node:22.23.3-alpine3.24 AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts ./apps/api/prisma.config.ts

WORKDIR /app/apps/api
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
