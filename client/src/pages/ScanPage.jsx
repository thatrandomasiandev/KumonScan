import { useEffect, useState, useRef, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { api, formatTime } from '../api';

const SCAN_COOLDOWN_MS = 3000;

function LiveClock({ timezone }) {
  const [display, setDisplay] = useState('--:--:--');
  const offsetRef = useRef(null);

  useEffect(() => {
    let tickInterval;

    async function sync() {
      try {
        const { iso } = await api.getTime();
        offsetRef.current = new Date(iso).getTime() - Date.now();
        updateDisplay();
        tickInterval = setInterval(updateDisplay, 1000);
      } catch {
        setDisplay('Time unavailable');
      }
    }

    function updateDisplay() {
      if (offsetRef.current == null) return;
      const now = new Date(Date.now() + offsetRef.current);
      setDisplay(
        now.toLocaleTimeString('en-US', {
          timeZone: timezone || 'America/Los_Angeles',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    }

    sync();
    const resync = setInterval(sync, 5 * 60 * 1000);

    return () => {
      clearInterval(tickInterval);
      clearInterval(resync);
    };
  }, [timezone]);

  return (
    <div className="text-center">
      <p className="text-white/60 text-xs uppercase tracking-widest mb-1">
        Center Time
      </p>
      <p className="text-white text-3xl sm:text-4xl font-light tabular-nums tracking-wide">
        {display}
      </p>
    </div>
  );
}

function ConfirmationCard({ result, onContinue }) {
  const isCheckIn = result.action === 'checked_in';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className={`card max-w-sm w-full text-center animate-in fade-in zoom-in duration-300 border-t-4 ${
          isCheckIn ? 'border-t-green-500' : 'border-t-orange-500'
        }`}
      >
        <div
          className={`w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl ${
            isCheckIn ? 'bg-green-100' : 'bg-orange-100'
          }`}
        >
          {isCheckIn ? '✅' : '👋'}
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">
          {result.student.name}
        </h2>
        <p
          className={`text-lg font-semibold mb-3 ${
            isCheckIn ? 'text-green-600' : 'text-orange-600'
          }`}
        >
          {isCheckIn ? 'Checked In' : 'Checked Out'}
        </p>
        <p className="text-gray-500 text-sm">
          {formatTime(result.timestamp, result.timezone)}
        </p>
        {result.action === 'checked_out' && result.session?.duration_minutes != null && (
          <p className="text-gray-400 text-sm mt-1">
            Session: {Math.round(result.session.duration_minutes)} minutes
          </p>
        )}
        <button
          type="button"
          onClick={onContinue}
          className="btn-primary w-full mt-6"
        >
          Continue Scanning
        </button>
      </div>
    </div>
  );
}

export default function ScanPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(true);
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const lastScanRef = useRef({ value: null, at: 0 });

  const resumeScanning = useCallback(() => {
    setResult(null);
    setScanning(true);
    processingRef.current = false;
  }, []);

  const handleScan = useCallback(async (decodedText) => {
    const now = Date.now();
    const lastScan = lastScanRef.current;

    if (processingRef.current) return;

    if (
      lastScan.value === decodedText &&
      now - lastScan.at < SCAN_COOLDOWN_MS
    ) {
      return;
    }

    processingRef.current = true;
    setError(null);

    try {
      const data = await api.scan(decodedText);
      lastScanRef.current = { value: decodedText, at: Date.now() };
      setTimezone(data.timezone);
      setResult(data);
      setScanning(false);

      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    } catch (err) {
      setError(err.message);
      processingRef.current = false;
      setTimeout(() => setError(null), 5000);
    }
  }, []);

  useEffect(() => {
    if (!scanning) return;

    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      {
        fps: 10,
        qrbox: { width: 280, height: 280 },
        aspectRatio: 1,
        showTorchButtonIfSupported: true,
      },
      false
    );

    scannerRef.current = scanner;

    scanner.render(
      (decodedText) => handleScan(decodedText),
      () => {}
    );

    return () => {
      scanner.clear().catch(() => {});
      scannerRef.current = null;
    };
  }, [scanning, handleScan]);

  useEffect(() => {
    api.getTime().then((t) => setTimezone(t.timezone)).catch(() => {});
  }, []);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gray-900 flex flex-col">
      <div className="py-6 px-4">
        <LiveClock timezone={timezone} />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-8">
        <p className="text-white/70 text-center mb-6 text-sm sm:text-base">
          Hold your QR code up to the camera to check in or out
        </p>

        <div className="w-full max-w-md">
          <div
            id="qr-reader"
            className="rounded-xl overflow-hidden [&_video]:rounded-xl"
          />
        </div>

        {error && (
          <div className="mt-4 bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg text-sm text-center max-w-md">
            {error}
          </div>
        )}
      </div>

      {result && (
        <ConfirmationCard result={result} onContinue={resumeScanning} />
      )}
    </div>
  );
}
