"""Local HTTP bridge for Qwen3-TTS-12Hz-1.7B-CustomVoice.

Run with: python qwen3_tts_server.py
The website sends POST /tts {"text":"...","speaker":"Serena"} and receives WAV audio.
"""
import io
import os

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from qwen_tts import Qwen3TTSModel
import uvicorn

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
CURATOR_INSTRUCTION = (
    "优雅、知性、沉静的成年女性美术馆讲解员声音。语速舒缓，吐字清晰，"
    "语气温和而有分寸。带领听众观察作品时自然停顿，重要细节略微强调，"
    "并留出欣赏和思考的时间。情感含蓄但不冷淡，避免播音腔、推销感和夸张表演。"
)
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if torch.cuda.is_available() else torch.float32
ORIGINS = os.getenv(
    "QWEN_TTS_ALLOWED_ORIGINS",
    "https://timeless-florence.haozi-w.chatgpt.site,http://localhost:3000",
).split(",")

app = FastAPI(title="Timeless Florence local Qwen3-TTS")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in ORIGINS if origin.strip()],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)
model: Qwen3TTSModel | None = None


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    speaker: str = "Serena"


def get_model() -> Qwen3TTSModel:
    global model
    if model is None:
        model = Qwen3TTSModel.from_pretrained(MODEL_ID, device_map=DEVICE, dtype=DTYPE)
    return model


@app.post("/tts")
def tts(request: TTSRequest):
    try:
        wavs, sample_rate = get_model().generate_custom_voice(
            text=request.text,
            language="Chinese",
            speaker=request.speaker,
            instruct=CURATOR_INSTRUCTION,
        )
        audio = io.BytesIO()
        sf.write(audio, np.asarray(wavs[0]), sample_rate, format="WAV")
        return Response(audio.getvalue(), media_type="audio/wav")
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Qwen3-TTS 生成失败：{error}") from error


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9233)
