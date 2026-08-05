# 로컬에서 "제출될 물건 그대로"를 띄워보기 위한 이미지.
# dev 서버가 아니라 **빌드 산출물(dist)을 정적 서빙**한다 — GitHub Pages와 같은 조건이다.
# 빌드를 깨끗한 환경에서 다시 하므로 로컬 캐시에 기대던 문제도 여기서 드러난다.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
# 의존성 레이어를 먼저 굳혀 소스만 바뀔 때 재설치를 피한다
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# 타입체크까지 도는 build 스크립트를 그대로 쓴다 (pnpm build = typecheck && vite build)
RUN pnpm build

FROM nginx:alpine
# base가 '/'인 빌드라 루트에 그대로 얹는다 (Pages 배포만 GHPAGES_BASE로 하위 경로를 쓴다)
COPY --from=build /app/dist /usr/share/nginx/html
# SPA는 아니지만 새로고침·직접 진입에서 404가 나지 않게 index로 폴백
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  location / { try_files $uri $uri/ /index.html; }\n\
  # 해시 붙은 에셋은 오래 캐시, index는 항상 재검증\n\
  location ~* \\.(js|css|png|jpg|jpeg|gif|svg|hdr|glb|gltf|ktx2|woff2?)$ { expires 7d; add_header Cache-Control "public, immutable"; }\n\
  location = /index.html { add_header Cache-Control "no-cache"; }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
