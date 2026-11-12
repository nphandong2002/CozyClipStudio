# CozyClip Studio

Ứng dụng desktop (Electron + React) tạo clip ASMR / cozy dài 1–2 giờ từ nhân vật Spine.

## Chạy lần đầu (Windows)

Cần **Node.js 20+** (https://nodejs.org).

```powershell
cd C:\Users\dongv\Downloads\spine\CozyClipStudio
npm install
npm run dev
```

- Lần đầu app tự tìm bộ Spine ở thư mục cha (`Downloads\spine`). Nếu không thấy, bấm **Thư mục Spine** và chọn thư mục có `*.json + *.atlas + *.png`.
- `npm install` tự tải ffmpeg (gói `ffmpeg-static`). Nếu mạng chặn, cài ffmpeg vào PATH là đủ.
- Đóng gói file .exe chạy độc lập: `npm run dist` → thư mục `release/`.

## Cách dùng

1. **Cảnh**: trong nhà / ngoài trời, thời điểm (ngày, hoàng hôn, đêm), thời tiết (mưa, giông, tuyết, sương), màu tường/sàn, âm lượng từng nhóm, độ phân giải, độ dài vòng lặp.
2. **Vật thể**: thêm lò sưởi, cửa sổ (hiện thời tiết bên ngoài), kệ sách, sách lật trang, đồng hồ, đèn, nến, máy hát, lửa trại, ao… Vật thể **ngoài trời** có tiếng riêng: suối/thác nhỏ (nước chảy róc rách), chuông gió (leng keng theo gió), bụi cây (lá xào xạc theo thời tiết), đài phun nước (róc rách nhẹ). Mỗi vật thể có lớp *Nền* hoặc *Tiền cảnh* (vẽ trước nhân vật) và độ mờ để tạo chiều sâu. Vật thể có 🔊 tự phát tiếng ASMR, chỉnh âm lượng riêng; tiếng được đặt trái/phải theo vị trí vật thể.
3. **Nhân vật**: thêm **nhiều nhân vật** vào cùng một clip (nút *Thêm nhân vật*). Mỗi nhân vật chọn riêng nhân vật trong bộ Spine, màu mắt, trang phục, mặt nạ, cần câu, kích thước. Nhân vật đứng gần (thấp hơn trên khung) tự được vẽ đè lên để tạo chiều sâu.
4. **Điểm neo**: vị trí nhân vật ngồi/nằm/đứng. Kéo thả trực tiếp trên khung hình. Mỗi nhân vật nên dùng điểm neo khác nhau để không chồng lên nhau.
5. **Timeline**: mỗi phân cảnh = số phút (+ đổi thời tiết/thời điểm nếu muốn), và **từng nhân vật có hành động + điểm neo riêng**. Nhân vật nào đổi điểm neo giữa 2 phân cảnh sẽ tự đi bộ sang (có tiếng bước chân); nhân vật khác đứng yên làm việc của mình. Âm thanh của mỗi nhân vật được đặt trái/phải theo điểm neo.
6. **Xuất video** → MP4 H.264 + AAC.

### Tải lên của riêng bạn
- **Ảnh làm vật thể**: tab *Vật thể* → **Tải ảnh của bạn làm vật thể** (PNG trong suốt là đẹp nhất). Ảnh thành một vật thể như mọi vật thể khác: kéo thả, chỉnh kích thước, lớp nền/tiền cảnh, làm mờ, lật ngang. Nút *Đổi ảnh khác* để thay.
- **Ảnh nền toàn cảnh**: tab *Cảnh* → **Tải ảnh nền**. Ảnh phủ kín khung (kiểu *cover*) thay cho nền vẽ code; nhân vật, vật thể, thời tiết và ánh sáng vẫn vẽ đè lên.
- **Nhạc / âm thanh nền**: tab *Cảnh* → **Tải nhạc nền** (mp3/wav). Nghe thử ngay trong app (phát lặp), chỉnh âm lượng riêng; khi xuất video, nhạc được ffmpeg lặp đủ độ dài và trộn cùng tiếng ASMR tổng hợp.

> Ảnh/nhạc được nhúng thẳng vào file dự án `.cozy.json` (dạng data URL) nên mở ở máy khác vẫn đủ. Dự án có nhiều ảnh/nhạc lớn có thể vượt giới hạn tự lưu nháp của trình duyệt — cứ **Lưu** ra file để chắc chắn.

### Phím tắt
Chọn một vật thể / điểm neo (bấm trên khung hình) rồi dùng:

| Phím | Tác dụng |
|---|---|
| `Delete` / `Backspace` | Xoá vật thể / điểm neo đang chọn (điểm neo đang dùng trong timeline thì không xoá) |
| `Ctrl+Z` / `Ctrl+Y` (hoặc `Ctrl+Shift+Z`) | Hoàn tác / Làm lại |
| `Ctrl+C` / `Ctrl+V` | Chép / Dán (dán lệch 40px) |
| `Ctrl+D` | Nhân bản tại chỗ |
| `← → ↑ ↓` | Dịch 1px (giữ `Shift` = 10px) |
| `Ctrl+S` | Lưu dự án |

Kéo thả bằng chuột được gộp thành **một** bước hoàn tác. Phím tắt không kích hoạt khi đang gõ trong ô nhập liệu.

## Cách xuất được video 2 giờ nhanh

Mọi chuyển động (lửa, mưa, hơi nước, con lắc đồng hồ, hành động nhân vật, sấm chớp, tiếng động) đều được tính **tuần hoàn** theo độ dài vòng lặp (mặc định 30s). Mỗi phân cảnh chỉ render **một vòng** rồi ffmpeg nối lặp lại bằng stream copy (không encode lại). Video 1h40 phút chỉ cần render ~5.000 khung hình thay vì 180.000. Âm thanh cũng được tổng hợp tuần hoàn, nên chỗ nối không bị "tách".

## Âm thanh

Toàn bộ âm thanh hiện được **tổng hợp bằng code** (`src/engine/dsp.js`, `src/engine/audio.js`): mưa, mưa gõ kính, gió, sấm (khớp với tia chớp), lửa tí tách, lật sách (khớp với hình trang sách lật), đồng hồ tích tắc (khớp con lắc), đĩa than, nước, suối/thác, chuông gió, lá xào xạc, đài phun nước, dế/chim, tiếng gừ gừ khi ngủ, quét nhà, đào đất, câu cá, bước chân.
Muốn dùng file âm thanh thật: thay hàm tạo layer tương ứng trong `audio.js` bằng dữ liệu decode từ file WAV (giữ nguyên cơ chế lặp).

## Cấu trúc

```
electron/main.cjs            cửa sổ, đọc Spine, lưu/mở dự án, IPC xuất video
electron/exportPipeline.cjs  ffmpeg: encode từng clip, nối lặp, trộn audio
src/engine/character.js      Spine: ghép skin, hành động, chớp mắt, dụng cụ (chổi, bay)
src/engine/props.js          vật thể vẽ bằng code + vật thể "Ảnh của bạn"
src/engine/images.js         nạp & cache ảnh upload (vật thể ảnh + ảnh nền)
src/engine/world.js          nền, bầu trời, mưa/tuyết/sương, ánh sáng, chớp
src/engine/scene.js          ghép khung hình + lập kế hoạch render từ timeline
src/engine/audio.js, dsp.js  âm thanh ASMR
src/engine/exporter.js       render khung → ffmpeg
src/ui/*                     giao diện
```

## Ghi chú

- Ảnh atlas của bộ Spine đang ở scale 0.24, nên nhân vật hơi mềm khi phóng lớn. Export lại từ Spine với scale 0.5–1 sẽ nét hơn.
- Bộ Spine không có chổi/xẻng — app tự vẽ dụng cụ gắn vào xương tay phải khi quét nhà / làm vườn.
- Kiểm tra nhanh toàn bộ đường xuất video: `set COZY_SELFTEST=C:\Users\dongv\Downloads\spine && npx electron .` (xuất `cozyclip-selftest.mp4` 2 phút vào thư mục đó).
