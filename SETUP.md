# One-time setup

1. In Chrome, go to `chrome://extensions`, enable **Developer mode**, click
   **"加载已解压的扩展程序"** (Load unpacked), and select this project's
   directory.
2. In Obsidian, install and enable the community plugin **Local REST API**.
3. In the plugin settings, enable **"Enable Non-encrypted (HTTP) Server"**
   (binds to `http://127.0.0.1:27123`). This avoids dealing with the
   plugin's self-signed HTTPS certificate since traffic never leaves
   this machine.
4. Copy the generated **API key** from the plugin settings.
5. Right-click the extension's toolbar icon and choose **"选项"** (or open
   it from the extension's card on `chrome://extensions`), paste the API
   key, and save.
