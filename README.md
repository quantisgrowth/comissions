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
