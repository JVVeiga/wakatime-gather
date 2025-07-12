# Build stage
FROM node:alpine AS builder

WORKDIR /app

COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --frozen-lockfile

COPY src ./src

RUN yarn tsc

# Production stage
FROM node:alpine AS production

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY package.json ./

ENV NODE_ENV=production
RUN yarn install --production

CMD ["node", "dist/run.js"]
