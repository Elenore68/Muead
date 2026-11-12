import { Topbar } from "../components/Layout";

export default function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <Topbar title={title} />
      <div className="card placeholder">This screen is not in the design reference yet.</div>
    </>
  );
}
