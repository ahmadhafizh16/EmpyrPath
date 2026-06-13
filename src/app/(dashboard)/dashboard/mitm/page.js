import { PageHero } from "@/shared/components";
import { SECTIONS } from "@/shared/constants/dashboardSections";
import MitmPageClient from "./MitmPageClient";

const S = SECTIONS.mitm;

export default function MitmPage() {
  return (
    <div data-section={S.color} className="flex flex-col gap-6">
      <PageHero
        section={S.color}
        eyebrow={S.eyebrow}
        title={S.title}
        description={S.description}
        icon={S.icon}
      />
      <MitmPageClient />
    </div>
  );
}
