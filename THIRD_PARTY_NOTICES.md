# Third-party notices

The experimental local Chinese speech option uses the following Apache-2.0 licensed projects:

- `@uzen/kokoro-js`, derived from Kokoro.js and Transformers.js: https://github.com/uzen-zone/kokoro-js
- Kokoro-82M-v1.1-zh-ONNX model and the bundled `zf_001` voice data: https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX

Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0

The application does not modify the model weights or voice data. The browser downloads model weights on first use and runs inference locally.
