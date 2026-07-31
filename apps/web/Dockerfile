FROM node:24 AS builder
RUN npm install -g pnpm@11
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

ARG VITE_MAP_STYLE_LIGHT=http://tiles.adversary/styles/liberty/style.json
ARG VITE_MAP_STYLE_DARK=http://tiles.adversary/styles/dark/style.json
ARG VITE_GEO_TILEJSON_URL=http://tiles.adversary/data/openmaptiles.json
ARG VITE_API_BASE_URL=http://api.adversary
ENV VITE_MAP_STYLE_LIGHT=$VITE_MAP_STYLE_LIGHT
ENV VITE_MAP_STYLE_DARK=$VITE_MAP_STYLE_DARK
ENV VITE_GEO_TILEJSON_URL=$VITE_GEO_TILEJSON_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY . .
RUN --mount=type=cache,target=/pnpm-store pnpm install --store-dir /pnpm-store

ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=
RUN cd apps/web && pnpm run build

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
