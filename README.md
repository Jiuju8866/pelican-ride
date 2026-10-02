# 鹈鹕骑行 Pelican Ride

一个用网页 JavaScript（Canvas 2D）写的伪 3D 休闲骑行小游戏：控制一只骑自行车的鹈鹕，在海边和田野路线上骑行、看风景、拍明信片。

**在线试玩：** https://jiuju8866.github.io/pelican-ride/

## 玩法
- 左下角摇杆转向，右下角滑杆调速度（键盘：方向键 / WASD）
- 📷 靠近地标时拍照收集明信片（C 键），🔔 车铃（B 键）
- 暂停：P / Esc，静音：M
- 每条路线有起点、4 个地标和终点，到终点会显示成绩

## 文件
- `index.html` + `game.js`：源码，无需构建
- `pelican-ride.html`：单文件版（由 `python3 build.py` 生成），离线双击即可玩
- `tools/`：Playwright 测试脚本

## 截图
![骑行](docs/v3-riding-photo.png)
![终点](docs/v3-finish.png)
![明信片册](docs/v3-album.png)
