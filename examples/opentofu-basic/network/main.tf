terraform {
  required_providers {
    local  = { source = "hashicorp/local", version = "2.5.3" }
    random = { source = "hashicorp/random", version = "3.7.2" }
    null   = { source = "hashicorp/null", version = "3.2.4" }
  }
}

variable "env" {
  type = string
}

variable "motd" {
  type    = string
  default = "hello"
}

# Marked sensitive, and still never shown by Sluiceway, marked or not.
variable "secret" {
  type      = string
  sensitive = true
  default   = "CANARY-SECRET"
}

resource "random_pet" "name" {
  prefix = var.env
}

# Changes in place: a new input is an update.
resource "terraform_data" "config" {
  input = {
    greeting = var.motd
    canary   = "CANARY-VALUE"
    secret   = var.secret
  }
}

# Every argument of a local_file forces a new one: a new content is a replace.
resource "local_file" "notes" {
  filename = "${path.module}/out/notes-${var.env}.txt"
  content  = "CANARY-VALUE ${var.motd}"
}

resource "null_resource" "trigger" {
  triggers = {
    secret = var.secret
  }
}

output "pet" {
  value = random_pet.name.id
}
