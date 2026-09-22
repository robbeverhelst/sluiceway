# Shared by every unit. The state stays in the local backend, next to each
# unit's terragrunt.hcl, so the example needs no cloud account.
remote_state {
  backend = "local"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    path = "${get_terragrunt_dir()}/terraform.tfstate"
  }
}
