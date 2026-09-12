// ============================================================================
// THE CAPABILITY SET IS CHOSEN HERE, BY A CARGO FEATURE (L-93).
// ============================================================================
// `tauri-build` globs `./capabilities/**/*` and validates every permission it
// finds against the plugins that are actually compiled in. That is the right
// default and it is why the Microsoft Store flavour cannot simply drop the
// updater: `capabilities/desktop.json` names `updater:default`, the Store build
// compiles without `tauri-plugin-updater`, and the build script then fails with
//
//     Permission updater:default not found, expected one of core:default, ...
//
// WHY NOT THE CONFIG. The obvious fix is `app.security.capabilities` in a
// `--config` merge, naming only the capabilities to keep. It does not work, and
// it fails in the worst way — silently, because the key is valid and simply has
// no effect here. This was measured rather than assumed: the merge was tried,
// the build failed identically, and `tauri-build` 2.6.3 says why — it parses the
// capability DIRECTORY before anything reads that list:
//
//     let capabilities = if let Some(pattern) = attributes.capabilities_path_pattern {
//       parse_capabilities(pattern)?
//     } else {
//       parse_capabilities("./capabilities/**/*")?
//     };
//
// So the config list is the RUNTIME view and the glob is the BUILD-TIME one.
// Only the glob can keep a capability out of the build, and
// `capabilities_path_pattern` is the supported way to set it.
//
// WHY A FEATURE AND NOT AN ENVIRONMENT VARIABLE. An env var would be a label
// somebody has to remember to set, checked nowhere. The feature is the same flag
// that removes the plugin from the dependency graph, so the capability set and
// the compiled plugins cannot disagree — and `src/lib.rs` raises a
// `compile_error!` if `microsoft-store` and `updater` are ever on together.
//
// `apps/light/src/lib/msix-store-build.contract.test.ts` fails the build if the
// pattern below ever starts matching a capability file that grants an
// `updater:` permission, and also if it is ever applied WITHOUT the feature gate
// — which would narrow the direct-download build, and that one still needs the
// updater.
fn main() {
    let attributes = tauri_build::Attributes::new();

    // The Store flavour gets the all-platform capability only. `desktop.json`
    // is deliberately left out: it grants `updater:default`, and the plugin
    // that permission belongs to is not in this build.
    #[cfg(feature = "microsoft-store")]
    let attributes = {
        // Required when the pattern is customised — `tauri-build` emits this
        // itself only for the default glob, so without it a changed capability
        // file would not rebuild the app.
        println!("cargo:rerun-if-changed=capabilities");
        attributes.capabilities_path_pattern("./capabilities/default.json")
    };

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
