import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown } from "lucide-react";

export function PreparationGuide() {
  return (
    <details className="sb-preparation-guide">
      <summary>
        <span>
          Antes do próximo atendimento <small>Confira os três passos de preparação</small>
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </summary>
      <ol>
        <li>
          <span>01</span>
          <div>
            <h3>Confira a conexão</h3>
            <p>
              Consulte o agente para saber se a conta está disponível. Ter uma sessão salva não
              confirma uma conexão ativa.
            </p>
            <Link to="/admin/connection">
              Ver conexões <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <h3>Revise grupo e mensagem</h3>
            <p>
              Abra o atendimento da cliente, habilite o grupo correto e confira o rascunho antes de
              iniciar.
            </p>
            <Link to="/dashboard/unico">
              Preparar atendimento <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <h3>Acompanhe a confirmação</h3>
            <p>
              Inicie o monitoramento e acompanhe os eventos. A senha só deve ser considerada
              definida quando a posição for confirmada.
            </p>
            <Link to="/dashboard/multi">
              Abrir atendimento multi <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          </div>
        </li>
      </ol>
    </details>
  );
}
