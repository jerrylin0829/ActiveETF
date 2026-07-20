export function PickingDisclosure() {
  return (
    <p
      role="note"
      className="border-t border-border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground"
    >
      此為訊號品質指標，未計部位大小，不等於績效貢獻；日內沖銷不會出現在每日 PCF
      快照中，無從計分。
    </p>
  );
}
