export default function BrandMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <>
      <img className={`brand-mark brand-mark-light ${className}`.trim()} style={{ width: size, height: size }} src="/brand/dudu-mark.svg" alt="" />
      <img className={`brand-mark brand-mark-dark ${className}`.trim()} style={{ width: size, height: size }} src="/brand/dudu-mark-dark.svg" alt="" />
    </>
  );
}
