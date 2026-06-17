# HTML Widget Example

The v0.1 widget is an ES module build. Build it first:

```bash
pnpm --filter @opensupportai/widget build
```

Serve `packages/widget/dist/opensupportai-widget.js` from your app, then load it with `type="module"`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenSupportAI Widget Example</title>
  </head>
  <body>
    <main>
      <h1>Host application</h1>
      <p>The support widget is mounted in the lower-right corner.</p>
    </main>

    <script type="module">
      import { OpenSupportAI } from "/opensupportai-widget.js";

      OpenSupportAI.init({
        apiUrl: "http://localhost:4000",
        projectId: "proj_demo",
        publicKey: "pk_demo",
        inboxId: "inbox_default",
        user: {
          id: "demo_user_html",
          name: "Demo User",
          email: "demo@example.com"
        },
        locale: "zh-CN"
      });
    </script>
  </body>
</html>
```

For local API development without a database:

```bash
OPENSUPPORTAI_STORAGE=memory PORT=4000 pnpm --filter @opensupportai/api dev
```

Try asking:

```text
怎么取消订阅？
我要转人工
```
