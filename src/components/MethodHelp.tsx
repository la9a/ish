export function MethodHelp() {
  return (
    <div className="text-left space-y-2">
      <div>
        <div className="font-medium text-foreground">Grupo fechado</div>
        <div className="text-muted-foreground">Mensagem envia assim que o admin ou dono abre o grupo.</div>
      </div>
      <div>
        <div className="font-medium text-foreground">Grupo aberto</div>
        <div className="text-muted-foreground">Mensagem envia assim que o admin ou dono envia alguma mensagem.</div>
      </div>
      <div>
        <div className="font-medium text-foreground">Grupo aberto 2</div>
        <div className="text-muted-foreground">Mensagem envia assim que bater o horário de envio.</div>
      </div>
    </div>
  );
}