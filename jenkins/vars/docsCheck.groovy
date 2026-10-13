// Shared Jenkins library step: fail a PR build when code a manual page covers changed
// but the page (or its doc flow) did not, and lint pages, flows and help ids.
//
//   docsCheck(app: 'apps/back-office-billing')
//
// A commit line "Docs: none" waives the check for that PR.
def call(Map args = [:]) {
  String app = args.app ?: error('docsCheck: pass app: "<path to the app root>"')
  String target = env.CHANGE_TARGET ?: (args.baseBranch ?: 'main')
  String base = "origin/${target}"

  stage("Docs check: ${app}") {
    // Jenkins does not fetch the target branch by default; both the diff and `nx affected` need it.
    autodocFetchBase(target)
    if (env.CHANGE_ID) {
      sh "npx autodoc check --app ${app} --base ${base}"
    } else {
      echo 'Not a PR build: skipping the docs check.'
    }
    sh "npx autodoc lint --app ${app}"
  }
}

def autodocFetchBase(String target) {
  sh """
    if git rev-parse --is-shallow-repository | grep -q true; then
      git fetch --no-tags --deepen=200 origin +refs/heads/${target}:refs/remotes/origin/${target}
    else
      git fetch --no-tags origin +refs/heads/${target}:refs/remotes/origin/${target}
    fi
  """
}
