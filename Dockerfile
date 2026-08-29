FROM nginx:1.27-alpine

COPY index.html editor.html styles.css app.js auth.js api.js questions-data.js am-avatar.jpg /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/index.html >/dev/null || exit 1
