---
order: 3
---

# Nginx 配置

Nginx 负责托管前端静态文件、把 `/api/` 反向代理到后端，并提供 HTTPS。

## 基本配置

```nginx
server {
    listen 80;
    server_name erp.example.com;

    # 附件上传：后端单个文件上限 100MB，单次请求上限 105MB（Nginx 默认只有 1MB）
    client_max_body_size 105m;

    # 前端静态文件
    location / {
        root /opt/lemon-erp/web;
        index index.html;
        # History 路由：刷新 /scm/purchase 等页面时回退到 index.html
        try_files $uri $uri/ /index.html;
    }

    # index.html 不缓存，发布新版本后用户刷新即可加载新的资源
    location = /index.html {
        root /opt/lemon-erp/web;
        add_header Cache-Control "no-cache";
    }

    # 带内容哈希的静态资源长期缓存
    location /assets/ {
        root /opt/lemon-erp/web;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }

    # 后端接口（后端 context-path 为 /api，原样转发，不要去掉前缀）
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    gzip on;
    gzip_min_length 1k;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
}
```

要点：

- **`proxy_pass` 后面不要带路径**（写成 `http://127.0.0.1:8080` 而不是 `http://127.0.0.1:8080/`），这样 `/api/auth/login` 原样转发到后端的 `/api/auth/login`；
- **`try_files ... /index.html`**：前端是 History 路由，直接访问或刷新 `/wms/stock` 时由前端路由处理；
- **`client_max_body_size`**：附件大小上限在「参数设置」中配置（默认 20MB，最大 100MB），Nginx 的上限要不小于它，否则上传时返回 413；
- **`X-Forwarded-For`**：后端据此记录真实的客户端 IP（操作日志、登录日志、在线用户的 IP 和归属地），见下文；
- 前端请求超时为 15 秒，`proxy_read_timeout` 保持默认或适当调大即可。

## HTTPS

```nginx
server {
    listen 80;
    server_name erp.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name erp.example.com;

    ssl_certificate     /etc/nginx/cert/erp.example.com.pem;
    ssl_certificate_key /etc/nginx/cert/erp.example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 105m;

    location / {
        root /opt/lemon-erp/web;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`http2 on;` 需要 Nginx 1.25.1 及以上，更早的版本写成 `listen 443 ssl http2;`。

## 真实客户端 IP

后端配置了 `server.forward-headers-strategy: native`，由 Tomcat 的 RemoteIpValve 处理转发头：

- 只有请求来自**内网代理**（10/8、172.16/12、192.168/16、127/8、169.254/16 以及 IPv6 本地地址等）时，才采用 `X-Forwarded-For` 中的地址作为客户端 IP；外部直接伪造该请求头无效；
- Nginx 与后端在同一台机器（`127.0.0.1`）或同一内网（含 Docker 默认网络 172.16/12）时，不需要额外配置；
- Nginx 或负载均衡器不在内网（例如经过公网地址的云负载均衡）时，用 `server.tomcat.remoteip.internal-proxies` 配置受信任代理地址的正则：

```bash
java -jar lemon-erp.jar --spring.profiles.active=prod \
  '--server.tomcat.remoteip.internal-proxies=10\.\d{1,3}\.\d{1,3}\.\d{1,3}|203\.0\.113\.10'
```

- 设置后会替换默认的内网地址范围，仍需要信任的内网代理要一并写进正则；
- 多级代理时，每一级都要用 `$proxy_add_x_forwarded_for` 追加地址，并且都在受信任范围内；
- `X-Forwarded-Proto` 让后端知道外部是 HTTPS 访问。

本地开发时 Vite 代理已开启 `xfwd`，在本机访问看到的是 `127.0.0.1` / 「内网IP」，属于正常现象。

## 部署在子路径下

前端路由和接口地址都基于根路径（路由 `createWebHistory()` 没有设置 base，接口 `baseURL` 为 `/api`），**推荐使用独立的域名或端口部署**。确实需要部署在子路径（如 `https://example.com/erp/`）时，需要同时修改前端的 Vite `base`、路由的 base、请求的 `baseURL` 和 Nginx 配置，后端 context-path 保持 `/api` 不变即可由 Nginx 转发。

## 负载均衡

多实例部署时：

```nginx
upstream lemon_erp {
    server 10.0.0.11:8080;
    server 10.0.0.12:8080;
}

location /api/ {
    proxy_pass http://lemon_erp;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

会话保存在 Redis 中，不需要会话粘滞。多实例的其他要求（定时任务、文件目录）见 [生产环境配置](./production)。

## 检查

```bash
nginx -t && nginx -s reload
curl -i http://erp.example.com/api/auth/config     # 返回 {"code":200,...}
```

浏览器打开首页、登录、刷新任意页面不出现 404，上传一个超过 1MB 的附件确认没有 413，即配置正确。
