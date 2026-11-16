import { Download } from "lucide-react";
import { useTask } from "../hooks/useTask";
import { Notice } from "./ui";

async function qrPng(url: string, signal: AbortSignal): Promise<Blob> {
  // Use the existing public QR endpoint without session credentials. Rasterize
  // locally; no new endpoint, QR payload or private reference lookup is needed.
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error("Không tải được mã QR. Vui lòng thử lại.");
  const source = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        image.src = "";
        reject(new DOMException("Đã hủy", "AbortError"));
      };
      const finish = (error?: Error) => {
        signal.removeEventListener("abort", abort);
        image.onload = null;
        image.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      image.onload = () => finish();
      image.onerror = () => finish(new Error("Không đọc được ảnh mã QR."));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      image.src = source;
    });
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt chưa hỗ trợ tạo ảnh QR.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 1024, 1024);
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 64, 64, 896, 896);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Không tạo được ảnh QR.")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(source);
  }
}

export function QrDownload({
  url,
  treeCode,
}: {
  url: string;
  treeCode: string;
}) {
  const task = useTask();
  return (
    <>
      <button
        className="button secondary"
        disabled={task.busy}
        onClick={() =>
          void task.run(async (signal) => {
            const blob = await qrPng(url, signal);
            signal.throwIfAborted();
            const target = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = target;
            anchor.download = `${treeCode}-qr.png`;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            // Keep the URL alive until the browser starts the download.
            setTimeout(() => URL.revokeObjectURL(target), 1000);
          })
        }
      >
        <Download size={16} />
        {task.busy ? "Đang tạo ảnh QR…" : "Tải mã QR PNG"}
      </button>
      {task.error && <Notice kind="error">{task.error}</Notice>}
    </>
  );
}
