# Comissions

Protótipo de gestão de contratos, recebíveis, metas e comissões para várias empresas do mesmo grupo.

## Executar localmente

Requer Python 3 e Node.js para as verificações:

```sh
python3 -m http.server 8765 --directory dist
node checks/sales.cjs
```

Abra http://localhost:8765.

## Funcionalidades

- Empresas, produtos e políticas independentes, com valores base editáveis.
- Vendas com vários produtos e geração de recebíveis.
- Comissões automáticas e extraordinárias; edição, exclusão reversível e histórico.
- Recebimentos e pagamentos de comissão separados.
- Filtros, ordenação por recebimento e exportação PDF no navegador.
- Metas mensais editáveis e simulação de perfis e acessos.

## Estado do protótipo

Os dados ficam no localStorage do navegador (chave `comissions-v2`). A autenticação e as permissões são simulações da interface, não mecanismos de segurança. Não há servidor, banco compartilhado ou integração bancária. Não use esta versão para compartilhar dados financeiros reais com a equipe.

Cadastros feitos em localhost não são transferidos ao domínio publicado. Não limpe os dados do navegador local sem fazer uma cópia deles. Cada navegador e domínio possui cadastros independentes.

Nenhum cadastro do navegador, captura de tela, chave ou documento de referência é incluído no repositório. A primeira abertura apresenta apenas três empresas genéricas e um administrador de demonstração. Produtos, contratos, metas e comissões começam vazios; nomes, regras e valores comerciais da versão local foram removidos.

## Publicação

O workflow `Deploy Comissions to GitHub Pages` testa e publica a pasta `dist` após alterações na branch `main`. Em Settings → Pages, selecione **GitHub Actions** como origem. A configuração do workflow usa apenas as permissões de publicação do GitHub e não exige segredos do aplicativo.

A próxima etapa para uso compartilhado é implementar autenticação real, banco de dados e autorização no servidor.
