import { PageHero } from "@/shared/components";
import { SECTIONS } from "@/shared/constants/dashboardSections";
import { getMachineId } from "@/shared/utils/machine";
import EndpointPageClient from "./EndpointPageClient";

const S = SECTIONS.endpoint;

export default async function EndpointPage() {
  const machineId = await getMachineId();
  return (
    <div data-section={S.color} className="flex flex-col gap-6">
      <PageHero
        section={S.color}
        eyebrow={S.eyebrow}
        title={S.title}
        description={S.description}
        icon={S.icon}
      />
      <EndpointPageClient machineId={machineId} />
    </div>
  );
}
