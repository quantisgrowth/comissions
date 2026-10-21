# Comissions

Gestão de contratos, recebíveis, metas e comissões por empresa.

## Aplicação publicada

Interface estática em GitHub Pages. Login e senhas são gerenciados pelo Supabase Auth; dados e convites são acessados exclusivamente pela Edge Function `comissions-api`.

- Convites por link individual de uso único, com validade de 24 horas. Nenhum e-mail é enviado pelo aplicativo.
- Administrador gerencia usuários e acessos. Gestor edita empresas autorizadas. Colaborador consulta apenas suas próprias comissões.
- Banco com RLS e acesso direto negado para `anon` e `authenticated`. A função autentica o usuário, consulta suas permissões atualizadas e filtra os dados no servidor.
- Salvamento com controle de versão; edições concorrentes exigem recarregamento para não sobrescrever alterações.
- A chave publicada no frontend é uma chave **publishable**; chaves administrativas são usadas apenas no servidor.
- O site não importa automaticamente os cadastros antigos de localhost/localStorage. A migração deve ser planejada separadamente.

## Estrutura

- `dist/`: aplicação estática, autenticação e exportação PDF.
- `backend/index.ts`: Edge Function (SDK com versão fixa).
- `backend/schema.sql`: estrutura inicial, com dados genéricos. Aplicação exige provisionar o primeiro administrador por acesso seguro ao banco, fora do repositório.
- `checks/`: testes de regras e autorização, sem criar usuários reais.

## Verificação

Requer Node.js 24:

```sh
node checks/sales.cjs
node checks/access.cjs
```

O workflow publica somente `dist/`. Alterações no backend devem ser implantadas no Supabase antes do frontend correspondente. Não publique senhas, links de convite ou chaves administrativas.

## Calendário de comissões

Em Comissões → Calendário de pagamentos, administradores e gestores com acesso a Comissões configuram o dia padrão por empresa e exceções por competência. Recebimentos até o último dia de um mês são programados para o mês seguinte. Dias 29–31 usam o último dia nos meses mais curtos. Nenhum dia é presumido quando o calendário ainda não foi configurado.

A baixa continua manual, individual ou em lote, feita pelo responsável e com data/meio reais. O servidor bloqueia pagamentos anteriores à programação e preserva a programação registrada em pagamentos anteriores. O portal de vendedores e colaboradores recebe somente comissões efetivamente pagas, sem previsões ou lançamentos em aberto.
