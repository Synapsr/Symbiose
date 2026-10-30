# Symbiose website: static build served by nginx.
# Build context: this folder (`/website` in Easypanel).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Optional: the public URL (e.g. https://symbiose.example), used for the
# canonical link and absolute social-card URLs. Relative URLs without it.
ARG SITE_URL=
ENV SITE_URL=${SITE_URL}
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
