# SuperTravel Demo

这是依据仓库根目录 `DESIGN.md` 与 `docs/SUPERTRAVEL_PRD_V2.md` 从零构建的独立 Web Demo，不依赖旧版 `frontend/`。

```bash
npm install
npm run dev
```

默认访问 `http://localhost:4173`。当前地图使用 Leaflet 与 OpenStreetMap 真实底图，地点带真实经纬度；地点间连线仅表示行程顺序，不是可导航路线。天气、费用、开放状态和行程内容仍为演示数据。

地图需要联网加载 `tile.openstreetmap.org`。公共瓦片仅适合低流量 Demo；正式部署应切换到具备 SLA 的地图服务，并保留地图数据署名。
