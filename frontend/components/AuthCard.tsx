import { Logo } from "@/components/Shell";

export function AuthCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex justify-center"><Logo height={26} /></div>
        <div className="panel p-6">
          <h1 className="text-[17px] font-semibold text-fg">{title}</h1>
          {sub && <p className="mt-1 text-[13px] text-fg-2">{sub}</p>}
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs2 text-fg-3">Authorised personnel only. Every access is recorded in the audit log.</p>
      </div>
    </div>
  );
}

export function Field({ label, hint, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input {...p} className="input mt-1" />
      {hint && <span className="mt-1 block text-xs2 text-fg-3">{hint}</span>}
    </label>
  );
}

export const PASSWORD_HINT = "At least 12 characters, with three of: lowercase, uppercase, digit, symbol.";
