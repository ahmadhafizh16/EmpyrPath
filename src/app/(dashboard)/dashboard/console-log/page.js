import { PageHero } from "@/shared/components";
import { SECTIONS } from "@/shared/constants/dashboardSections";
import ConsoleLogClient from "./ConsoleLogClient";

// Force dynamic so Next.js standalone build includes the server-side JS file
export const dynamic = "force-dynamic";

const S = SECTIONS["console-log"];

export default function ConsoleLogPage() {
  return (
    <div data-section={S.color} className="flex flex-col gap-6">
      <PageHero
        section={S.color}
        eyebrow={S.eyebrow}
        title={S.title}
        description={S.description}
        icon={S.icon}
      />
      <ConsoleLogClient />
    </div>
  );
}
