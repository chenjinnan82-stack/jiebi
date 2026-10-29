# Install and use Jiebi 0.5.2 preview

1. Unzip the extension package, or use the `extension` folder in this repository.
2. In Chrome, open **Extensions → Manage Extensions**, enable **Developer mode**, choose **Load unpacked**, and select that folder.
3. Pin **接笔**. After an update, reload it from the extension manager and refresh the ordinary page where you want the paper roll. The same extension ID keeps existing drafts.
4. The local service uses `127.0.0.1:5331`. Hosted reviewing additionally requires **More (···) → 助手连接 → 连接服务 → 评审服务**, then the private judging code and **保存连接**. Hosted access is not yet verified in this preview.

Open the upper-right roll. Write anywhere, or swipe the bottom edge to draw. The select, erase and undo icons sit on that edge. Push the lower roll upward and release to hand over; Escape or clicking away only saves. Peel the corner for another paper. Green marks are yours; rose marks are the assistant's. Human-edited assistant marks stay protected.

On browser settings, extension-store and other restricted pages, click the toolbar icon for the same paper and archive. The daily workflow does not open a separate webpage. `/extension-preview/` is developer-only.

A moving dot represents a pending handoff, not progress or an estimated completion time. A still rose dot means a new reply. Offline work remains saved; failed generation does not silently switch models. An older reply goes into that paper's history if you edited while waiting.

Keyboard alternatives and model setup are in [README.md](README.md). Use **More → 保存这张纸** to export the page as a PNG. Removing the extension can erase its Chrome-local paper storage; export what you want to keep first. Removing only the optional macOS bridge leaves the extension papers and server jobs intact.
