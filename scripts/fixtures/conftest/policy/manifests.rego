# A policy over Kubernetes manifests, for the recording of a YAML document
# with several objects in it.
package manifests

import rego.v1

deny contains msg if {
  input.kind == "Deployment"
  input.spec.replicas < 2
  msg := sprintf("%s needs at least 2 replicas", [input.metadata.name])
}
