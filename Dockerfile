ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS build
ARG VITE_API_ENDPOINT=http://localhost:3000
ARG VITE_GAME_ENDPOINT=http://localhost:2567
ENV DATABASE_URL=postgresql://ddz:ddz@localhost:5432/ddz
ENV VITE_API_ENDPOINT=$VITE_API_ENDPOINT
ENV VITE_GAME_ENDPOINT=$VITE_GAME_ENDPOINT
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ddz/api db:generate
RUN pnpm build

FROM base AS app
ENV NODE_ENV=production
COPY --from=build /app /app

FROM ${NGINX_IMAGE} AS web
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
