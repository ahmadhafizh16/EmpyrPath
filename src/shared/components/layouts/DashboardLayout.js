"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-[var(--color-mm-success-text)]/30 bg-[var(--color-mm-success-bg)] text-[var(--color-mm-success-text)]",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-danger/30 bg-danger/10 text-danger",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-warning/30 bg-warning/10 text-warning",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-hairline bg-mm-surface text-ink",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-ink-surface">
      <div className="fixed top-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`rounded-mm-xl border px-4 py-3 shadow-[var(--shadow-elev)] ${style.wrapper}`}
            >
              <div className="flex items-start gap-2.5">
                <span className="material-symbols-outlined text-[18px] leading-5">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5">{n.title}</p> : null}
                  <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="text-current/70 hover:text-current"
                    aria-label="Dismiss notification"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink-surface/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Sidebar - Mobile */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform lg:hidden transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content — ink background with subtle dot pattern (DESIGN.md). */}
      <main className="flex flex-col flex-1 h-full min-w-0 relative bg-ink-surface bg-pattern-dots">
        <Header key={pathname} onMenuClick={() => setSidebarOpen(true)} />
        {/* All pages use max-w-screen-2xl for wide layouts. basic-chat keeps
            its full-bleed flex layout. */}
        {(() => {
          const isChat = pathname === "/dashboard/basic-chat";
          const innerCls = isChat
            ? "flex-1 w-full h-full flex flex-col"
            : "max-w-screen-2xl mx-auto";
          return (
            <div className={`flex-1 overflow-y-auto custom-scrollbar ${isChat ? "" : "p-6 lg:p-10"} ${isChat ? "flex flex-col overflow-hidden" : ""}`}>
              <div className={innerCls}>{children}</div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
