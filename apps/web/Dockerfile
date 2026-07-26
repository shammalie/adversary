FROM node:24 AS builder
RUN npm install -g pnpm@11
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

ARG VITE_MAP_STYLE_LIGHT=http://tiles.adversary/styles/liberty/style.json
ARG VITE_MAP_STYLE_DARK=http://tiles.adversary/styles/dark/style.json
ENV VITE_MAP_STYLE_LIGHT=$VITE_MAP_STYLE_LIGHT
ENV VITE_MAP_STYLE_DARK=$VITE_MAP_STYLE_DARK

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
