import { useState } from "react";
import { predict } from "../api/client";
import type { PredictResponse } from "../types";

type Status = "idle" | "loading" | "done" | "error";

export function usePredict() {
  const [status,   setStatus]   = useState<Status>("idle");
  const [result,   setResult]   = useState<PredictResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function run(imageB64: string, figureId: string, studentId: number) {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const data = await predict({ image_b64: imageB64, figure_id: figureId, student_id: studentId });
      setResult(data);
      setStatus("done");
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      setErrorMsg(msg);
      setStatus("error");
      return null;
    }
  }

  function reset() {
    setStatus("idle");
    setResult(null);
    setErrorMsg(null);
  }

  return { status, result, errorMsg, run, reset };
}
