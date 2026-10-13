// Shared Jenkins library step: run the app's doc flows and send the screenshots to Lookout,
// which posts a build status on the Bitbucket PR (required or advisory, per Lookout's config).
//
//   docShots(app: 'apps/back-office-billing')
//
// On a PR only the affected pages' flows run; Lookout reuses the other shots from its last build.
// On the base branch every flow runs, and the manual site is built into <app>/docs-site.
def call(Map args = [:]) {
  String app = args.app ?: error('docShots: pass app: "<path to the app root>"')
  String target = env.CHANGE_TARGET ?: (args.baseBranch ?: 'main')
  String credentials = args.lookoutCredentials ?: 'lookout-token'
  String config = args.playwrightConfig ?: "${app}/playwright.docs.config.ts"

  stage("Doc screenshots: ${app}") {
    String pages = ''
    if (env.CHANGE_ID) {
      docsCheck.autodocFetchBase(target)
      pages = sh(script: "npx autodoc affected --app ${app} --base origin/${target}", returnStdout: true).trim()
      if (!pages) {
        echo 'No manual pages affected by this change.'
        return
      }
      echo "Capturing: ${pages}"
    }
    withEnv(["AUTODOC_PAGES=${pages}"]) {
      sh "npx playwright test -c ${config}"
    }
    withCredentials([string(credentialsId: credentials, variable: 'LOOKOUT_TOKEN')]) {
      sh "npx autodoc upload --app ${app}${pages ? ' --partial' : ''}"
    }
    if (!env.CHANGE_ID) {
      sh "npx autodoc site --app ${app} --out ${app}/docs-site"
      archiveArtifacts artifacts: "${app}/docs-site/**", allowEmptyArchive: false
    }
  }
}
