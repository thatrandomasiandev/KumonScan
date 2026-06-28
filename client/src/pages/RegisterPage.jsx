import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Link } from 'react-router-dom';
import { api, formatTime } from '../api';

const QR_OPTIONS = {
  width: 280,
  margin: 2,
  color: { dark: '#003087', light: '#ffffff' },
};

function CheckInResult({ result }) {
  const isCheckIn = result.action === 'checked_in';

  return (
    <div
      className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
        isCheckIn
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-orange-200 bg-orange-50 text-orange-800'
      }`}
    >
      <p className="font-semibold">
        {isCheckIn ? 'Checked in successfully!' : 'Checked out successfully!'}
      </p>
      <p className="mt-1 opacity-80">
        {formatTime(result.timestamp, result.timezone)}
      </p>
    </div>
  );
}

function QRResult({ registration, onReset }) {
  const canvasRef = useRef(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState(null);
  const [checkInResult, setCheckInResult] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function renderQr() {
      const dataUrl = await QRCode.toDataURL(registration.qr_code_value, QR_OPTIONS);
      if (cancelled) return;

      setQrDataUrl(dataUrl);

      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, registration.qr_code_value, QR_OPTIONS);
      }
    }

    renderQr();

    return () => {
      cancelled = true;
    };
  }, [registration.qr_code_value]);

  async function handleCheckIn() {
    setCheckingIn(true);
    setCheckInError(null);

    const isCheckout = checkInResult?.action === 'checked_in';

    try {
      const data = await api.scan(registration.qr_code_value, { force: isCheckout });
      setCheckInResult(data);
    } catch (err) {
      setCheckInError(err.message);
    } finally {
      setCheckingIn(false);
    }
  }

  function downloadQr() {
    if (!qrDataUrl) return;

    const link = document.createElement('a');
    link.download = `${registration.first_name}_${registration.last_name}_QR.png`;
    link.href = qrDataUrl;
    link.click();
  }

  function printQr() {
    if (!qrDataUrl) return;

    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) return;

    const fullName = `${registration.first_name} ${registration.last_name}`;
    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${fullName} - Kumon QR Code</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #111827;
      }
      img {
        width: 280px;
        height: 280px;
      }
      h1 {
        margin: 24px 0 8px;
        font-size: 28px;
        font-weight: 700;
      }
      p {
        margin: 0;
        color: #6b7280;
        font-size: 16px;
      }
    </style>
  </head>
  <body>
    <img src="${qrDataUrl}" alt="QR code for ${fullName}" />
    <h1>${fullName}</h1>
    <p>Personal Kumon check-in QR code</p>
  </body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => {
      printWindow.print();
    };
  }

  return (
    <div className="w-full max-w-md mx-auto text-center">
      {registration.is_new ? (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800 text-sm">
          You&apos;ve been registered! Save your QR code below.
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800 text-sm">
          Welcome back! Here&apos;s your QR code.
        </div>
      )}

      <div className="card flex flex-col items-center">
        <canvas
          ref={canvasRef}
          className="mx-auto mb-6 rounded-lg"
          style={{ minWidth: 250, minHeight: 250 }}
          aria-label={`QR code for ${registration.first_name}`}
        />

        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Welcome, {registration.first_name}!
        </h2>
        <p className="text-gray-500 mb-6">
          This is your personal Kumon check-in QR code.
        </p>

        <button
          type="button"
          onClick={handleCheckIn}
          className="btn-primary w-full py-3 text-base mb-3"
          disabled={checkingIn}
        >
          {checkingIn
            ? 'Processing...'
            : checkInResult?.action === 'checked_in'
              ? 'Check Out'
              : 'Check In Now'}
        </button>

        {checkInResult && <CheckInResult result={checkInResult} />}

        {checkInError && (
          <div className="mt-4 w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {checkInError}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto mt-4">
          <button
            type="button"
            onClick={downloadQr}
            className="btn-secondary w-full sm:w-auto"
            disabled={!qrDataUrl}
          >
            Download QR Code
          </button>
          <button
            type="button"
            onClick={printQr}
            className="btn-secondary w-full sm:w-auto"
            disabled={!qrDataUrl}
          >
            Print QR Code
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-3 w-full">
          <Link to="/" className="btn-secondary w-full text-center">
            Open Check-In Scanner
          </Link>
          <button
            type="button"
            onClick={onReset}
            className="text-sm text-gray-500 hover:text-kumon-blue"
          >
            ← Back · Not you?
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [registration, setRegistration] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const data = await api.register(firstName, lastName);
      setRegistration(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setRegistration(null);
    setFirstName('');
    setLastName('');
    setError(null);
  }

  return (
    <div className="min-h-screen bg-kumon-light flex flex-col">
      <header className="bg-kumon-blue text-white shadow-md">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link
            to="/"
            className="text-sm text-white/80 hover:text-white whitespace-nowrap"
          >
            ← Check In
          </Link>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-white rounded-full flex items-center justify-center shrink-0">
              <span className="text-kumon-blue font-bold text-sm">K</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">KumonScan</h1>
              <p className="text-white/70 text-xs truncate">Student Registration Portal</p>
            </div>
          </div>
          <div className="w-16" aria-hidden="true" />
        </div>
      </header>

      <main className="flex-1 px-4 py-8">
        <div className="max-w-md mx-auto">
          {!registration ? (
            <>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  Get Your QR Code
                </h2>
                <p className="text-gray-500 text-sm">
                  Enter your name to look up or create your personal check-in QR code.
                </p>
              </div>

              <div className="card">
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label
                      htmlFor="first-name"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      First Name
                    </label>
                    <input
                      id="first-name"
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Enter your first name"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-kumon-blue/30"
                      autoComplete="given-name"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="last-name"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Last Name
                    </label>
                    <input
                      id="last-name"
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Enter your last name"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-kumon-blue/30"
                      autoComplete="family-name"
                      required
                    />
                  </div>

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn-primary w-full py-3 text-base"
                    disabled={submitting}
                  >
                    {submitting ? 'Looking up...' : 'Get My QR Code'}
                  </button>
                </form>
              </div>

              <div className="flex flex-col gap-3 mt-6">
                <Link to="/" className="btn-secondary w-full text-center">
                  Go to Check-In Scanner
                </Link>
              </div>
            </>
          ) : (
            <QRResult registration={registration} onReset={handleReset} />
          )}
        </div>
      </main>
    </div>
  );
}
